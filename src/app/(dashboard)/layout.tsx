import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from './sign-out-button'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-lg font-semibold tracking-tight">PreCon AI</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link
            href="/projects"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Projects
          </Link>
          <Link
            href="/documents"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground"
          >
            Documents
          </Link>
        </nav>
        <div className="p-4 border-t">
          <SignOutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
