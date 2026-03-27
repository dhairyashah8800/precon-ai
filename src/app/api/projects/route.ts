import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userProfile, error: userError } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError || !userProfile) {
    return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
  }

  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, code, name, agency, bid_date, status, created_at')
    .eq('org_id', userProfile.org_id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ projects })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userProfile, error: userError } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError || !userProfile) {
    return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
  }

  const body = await request.json()
  const { code, name, agency, bid_date } = body

  if (!code || !name || !agency) {
    return NextResponse.json({ error: 'code, name, and agency are required' }, { status: 400 })
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      org_id: userProfile.org_id,
      code,
      name,
      agency,
      bid_date: bid_date || null,
      status: 'active',
    })
    .select('id, code, name, agency, bid_date, status, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ project }, { status: 201 })
}
