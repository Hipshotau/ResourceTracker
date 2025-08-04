import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { db, resources } from '../lib/db'

console.log('✅ NEW SCRIPT RUNNING ✅')

// Function to convert image filenames to resource names
function deslugify(filename: string): string {
  const namePart = filename
    .replace('t_ui_iconresource', '')
    .replace('r_d.webp', '')
  return namePart
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Infer category based on name
function guessCategory(name: string): string {
  if (/ore|rock|sand|fiber|raw/i.test(name)) return 'Raw Resources'
  if (/ingot|paste|crystal|block|lubricant|dust/i.test(name)) return 'Refined Resources'
  return 'Components'
}

// Calculate resource status
function calculateStatus(quantity: number, target: number): string {
  const percentage = (quantity / target) * 100
  if (percentage >= 100) return 'at_target'
  if (percentage >= 50) return 'below_target'
  return 'critical'
}

// Estimate target based on current and emoji status
function estimateTarget(quantity: number, statusFromEmoji: string): number {
  switch (statusFromEmoji) {
    case 'at_target': return Math.floor(quantity * 0.9)
    case 'below_target': return Math.floor(quantity * 1.5)
    case 'critical': return quantity > 0 ? Math.floor(quantity * 3) : 1000
    default: return quantity > 0 ? quantity : 1000
  }
}

// Generate resource objects from files
function generateResourcesFromFiles(): any[] {
  const resourceDir = path.resolve(__dirname, '../public/assets')
  const files = fs.readdirSync(resourceDir).filter(file =>
    file.startsWith('t_ui_iconresource') && file.endsWith('r_d.webp')
  )

  return files.map(filename => {
    const name = deslugify(filename)
    const slug = name.replace(/\s+/g, '')
    const imageUrl = `/assets/${filename}` // ✅ correct
    const icon = `:${slug}:`
    const category = guessCategory(name)
    const quantity = 0
    const status = 'critical'
    const target = estimateTarget(quantity, status)

    return {
      id: nanoid(),
      name,
      quantity,
      description: `${category} - ${name}`,
      category,
      icon,
      status,
      targetQuantity: target,
      lastUpdatedBy: 'AutoScript',
      createdAt: new Date(),
      updatedAt: new Date(),
      imageUrl,
    }
  })
}

async function populateResources() {
  try {
    console.log('🚀 Starting to populate resources from image files...')

    const resourceData = generateResourcesFromFiles()

    console.log(`🧼 Deleting existing resources...`)
    await db.delete(resources)

    const batchSize = 10
    for (let i = 0; i < resourceData.length; i += batchSize) {
      const batch = resourceData.slice(i, i + batchSize)
      await db.insert(resources).values(batch)
      console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(resourceData.length / batchSize)}`)
    }

    const counts = {
      Raw: resourceData.filter(r => r.category === 'Raw Resources').length,
      Refined: resourceData.filter(r => r.category === 'Refined Resources').length,
      Components: resourceData.filter(r => r.category === 'Components').length,
    }

    console.log('🎉 Successfully populated all resources!')
    console.log(`📊 Summary:`)
    console.log(`- Raw Resources: ${counts.Raw}`)
    console.log(`- Refined Resources: ${counts.Refined}`)
    console.log(`- Components: ${counts.Components}`)
    console.log(`- Total: ${resourceData.length}`)

  } catch (error) {
    console.error('❌ Error populating resources:', error)
  }
}

// Run the script
populateResources().then(() => {
  console.log('🏁 Script completed!')
  process.exit(0)
}).catch(error => {
  console.error('💥 Script failed:', error)
  process.exit(1)
})
