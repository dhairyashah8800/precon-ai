'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signUp(_prevState: { error: string } | null, formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('fullName') as string
  const orgName = formData.get('orgName') as string

  const supabase = await createClient()

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })

  if (signUpError) {
    return { error: signUpError.message }
  }

  if (!data.user) {
    return { error: 'Signup failed — please try again.' }
  }

  // Use service role to create org and user profile, bypassing RLS
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Check for orphaned auth user (previous failed signup) — user exists in auth but not public.users
  const { data: existingUser } = await admin
    .from('users')
    .select('id')
    .eq('id', data.user.id)
    .single()

  if (existingUser) {
    // Profile already exists, just redirect
    redirect('/projects')
  }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: orgName })
    .select('id')
    .single()

  if (orgError || !org) {
    console.error('[signup] org insert error:', orgError)
    return { error: 'Failed to create organization. Please contact support.' }
  }

  const { error: userError } = await admin.from('users').insert({
    id: data.user.id,
    org_id: org.id,
    email,
    name: fullName,
    role: 'admin',
  })

  if (userError) {
    console.error('[signup] user insert error:', userError)
    return { error: 'Failed to create user profile. Please contact support.' }
  }

  redirect('/projects')
}
