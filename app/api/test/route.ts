import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ 
    message: 'API Route is working!',
    timestamp: new Date().toISOString()
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ 
      message: 'POST request received',
      received: body
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    )
  }
}
