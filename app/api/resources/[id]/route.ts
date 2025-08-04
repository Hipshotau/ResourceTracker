import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getUserIdentifier } from '@/lib/auth'
import { db, resources, resourceHistory } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  hasResourceAccess,
  hasResourceAdminAccess,
  hasTargetEditAccess
} from '@/lib/discord-roles'
import { awardPoints } from '@/lib/leaderboard'

// Status calculation logic
const calculateResourceStatus = (
  quantity: number,
  targetQuantity: number | null
): 'above_target' | 'at_target' | 'below_target' | 'critical' => {
  if (!targetQuantity || targetQuantity <= 0) return 'at_target'
  const percentage = (quantity / targetQuantity) * 100
  if (percentage >= 150) return 'above_target'
  if (percentage >= 100) return 'at_target'
  if (percentage >= 50) return 'below_target'
  return 'critical'
}

// PUT /api/resources/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session || !hasResourceAccess(session.user.roles)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  console.log('[PUT] Resource update body:', body)
  console.log('[PUT] Target ID:', params.id)

  const resourceQuery = await db
    .select()
    .from(resources)
    .where(eq(resources.id, params.id))

  if (resourceQuery.length === 0) {
    return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
  }

  const existing = resourceQuery[0]
  const userId = getUserIdentifier(session)

  try {
    // Quantity change (with history + points)
    if ('quantity' in body) {
      const { quantity, updateType = 'absolute', value, reason } = body
      const previousQuantity = existing.quantity
      const changeAmount =
        updateType === 'relative' ? value : quantity - previousQuantity

      await db
        .update(resources)
        .set({
          quantity,
          lastUpdatedBy: userId,
          updatedAt: new Date()
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
        createdAt: new Date()
      })

      return NextResponse.json({ message: 'Quantity updated' })
    }

    // Metadata change
    const updates: Record<string, any> = {
      updatedAt: new Date()
    }

    // Apply only provided metadata fields (including falsy values like 0 or "")
    if ('name' in body) updates.name = body.name
    if ('imageUrl' in body) updates.imageUrl = body.imageUrl
    if ('category' in body) updates.category = body.category
    if ('description' in body) updates.description = body.description
    if ('targetQuantity' in body) updates.targetQuantity = body.targetQuantity
    if ('multiplier' in body) updates.multiplier = body.multiplier

    await db
      .update(resources)
      .set(updates)
      .where(eq(resources.id, params.id))

    return NextResponse.json({ message: 'Metadata updated' })
  } catch (error) {
    console.error('Error updating resource:', error)
    return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 })
  }
}

// DELETE /api/resources/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session || !hasResourceAdminAccess(session.user.roles)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const existing = await db
      .select()
      .from(resources)
      .where(eq(resources.id, params.id))

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    await db.delete(resourceHistory).where(eq(resourceHistory.resourceId, params.id))
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
