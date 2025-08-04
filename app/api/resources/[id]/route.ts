import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getUserIdentifier } from '@/lib/auth'
import { db } from '@/lib/db'
import { resources, resourceHistory } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { hasResourceAccess, hasResourceAdminAccess } from '@/lib/discord-roles'
import { awardPoints } from '@/lib/leaderboard'

// Calculate status based on quantity vs target
const calculateResourceStatus = (quantity: number, targetQuantity: number | null): 'above_target' | 'at_target' | 'below_target' | 'critical' => {
  if (!targetQuantity || targetQuantity <= 0) return 'at_target'

  const percentage = (quantity / targetQuantity) * 100
  if (percentage >= 150) return 'above_target'    // Purple - well above target
  if (percentage >= 100) return 'at_target'       // Green - at or above target
  if (percentage >= 50) return 'below_target'     // Orange - below target but not critical
  return 'critical'                               // Red - very much below target
}

// Import role-checking functions from discord-roles.ts
import { hasTargetEditAccess } from '@/lib/discord-roles'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)

  if (!session || !hasResourceAccess(session.user.roles)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const userId = getUserIdentifier(session)

    const current = await db.select().from(resources).where(eq(resources.id, params.id))
    if (current.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    const existing = current[0]

    // Handle quantity updates
    if ('quantity' in body) {
      const { quantity, updateType = 'absolute', value, reason } = body
      const previousQuantity = existing.quantity
      const changeAmount = updateType === 'relative' ? value : quantity - previousQuantity

      await db.update(resources)
        .set({
          quantity,
          lastUpdatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(resources.id, params.id))

      await db.insert(resourceHistory).values({
        id: nanoid(),
        resourceId: params.id,
        previousQuantity,
        newQuantity: quantity,
        changeAmount,
        changeType: updateType,
        updatedBy: userId,
        reason,
        createdAt: new Date(),
      })

      return NextResponse.json({ message: 'Quantity updated' })
    }

    // Handle metadata update
    const { name, imageUrl, category, description, targetQuantity, multiplier } = body

    await db.update(resources)
      .set({
        ...(name && { name }),
        ...(imageUrl && { imageUrl }),
        ...(category && { category }),
        ...(description && { description }),
        ...(targetQuantity !== undefined && { targetQuantity }),
        ...(multiplier !== undefined && { multiplier }),
        updatedAt: new Date(),
      })
      .where(eq(resources.id, params.id))

    return NextResponse.json({ message: 'Metadata updated' })
  } catch (error) {
    console.error('Error updating resource:', error)
    return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 })
  }
}



// DELETE /api/resources/[id] - Delete resource and all its history (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  
  if (!session || !hasResourceAdminAccess(session.user.roles)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    // Check if resource exists
    const resource = await db.select().from(resources).where(eq(resources.id, params.id))
    if (resource.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    // Delete all history entries for this resource first (due to foreign key constraint)
    await db.delete(resourceHistory).where(eq(resourceHistory.resourceId, params.id))
    
    // Delete the resource
    await db.delete(resources).where(eq(resources.id, params.id))

    return NextResponse.json({ message: 'Resource and its history deleted successfully' }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('Error deleting resource:', error)
    return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 })
  }
} 