import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useOperatorContext } from '@/app/OperatorContextProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type FormValues = {
  tenantId: string
  userId: string
  projectId: string
  sessionId: string
}

/**
 * Always-visible operator-context bar. Shows TENANT/USER (and PROJECT/SESSION
 * when set) as mono values; amber warning treatment when tenant or user is
 * unset (memory is unusable without them). Click → popover edit form;
 * non-secret scope only — persistence is OperatorContextProvider's job (D-01).
 */

/**
 * SHELL-06 error-toast contract: error feedback follows
 * "{action} failed — {HTTP status}: {upstream message}" and carries a
 * "Copy error" affordance. Reused by all shell write/lifecycle actions.
 */
// eslint-disable-next-line react-refresh/only-export-components -- SHELL-06 shared error reporter co-located with the bar per plan scope
export function reportError(action: string, status: number, message: string) {
  const text = `${action} failed — ${status}: ${message}`
  toast.error(text, {
    action: {
      label: 'Copy error',
      onClick: () => {
        void navigator.clipboard?.writeText(text)
      },
    },
  })
}

function MonoValue({ label, value }: { label: string; value: string }) {
  const unset = value === ''
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className="text-[12px] font-semibold uppercase tracking-[0.04em] mono"
        style={{ color: 'var(--muted-foreground)', letterSpacing: '0.04em' }}
      >
        {label}
      </span>
      <span
        className="mono text-[14px]"
        style={{
          color: unset ? 'var(--status-degraded)' : 'var(--foreground)',
        }}
      >
        {unset ? 'not set' : value}
      </span>
    </span>
  )
}

export function OperatorContextBar() {
  const ctx = useOperatorContext()
  const [open, setOpen] = useState(false)

  const unusable = ctx.tenantId === '' || ctx.userId === ''
  const bothSet = ctx.tenantId !== '' && ctx.userId !== ''
  const ctaLabel = bothSet ? 'Save context' : 'Set context'

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
      })
    }
  }, [open, ctx.tenantId, ctx.userId, ctx.projectId, ctx.sessionId, reset])

  function onSubmit(values: FormValues) {
    ctx.setContext(values)
    setOpen(false)
    toast.success('Context saved.')
  }

  return (
    <div
      className="flex items-center gap-3 rounded-md border px-3 py-1.5"
      style={{
        borderColor: unusable ? 'var(--status-degraded)' : 'var(--border)',
        backgroundColor: unusable
          ? 'color-mix(in srgb, var(--status-degraded) 8%, var(--card))'
          : 'var(--card)',
      }}
    >
      <MonoValue label="TENANT" value={ctx.tenantId} />
      <MonoValue label="USER" value={ctx.userId} />
      {ctx.projectId !== '' && (
        <MonoValue label="PROJECT" value={ctx.projectId} />
      )}
      {ctx.sessionId !== '' && (
        <MonoValue label="SESSION" value={ctx.sessionId} />
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Edit operator context"
          >
            <Pencil className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <form
            className="flex flex-col gap-3"
            onSubmit={handleSubmit(onSubmit)}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ctx-tenant" className="mono">
                TENANT
              </Label>
              <Input id="ctx-tenant" className="mono" {...register('tenantId')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ctx-user" className="mono">
                USER
              </Label>
              <Input id="ctx-user" className="mono" {...register('userId')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ctx-project" className="mono">
                PROJECT
              </Label>
              <Input
                id="ctx-project"
                className="mono"
                {...register('projectId')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ctx-session" className="mono">
                SESSION
              </Label>
              <Input
                id="ctx-session"
                className="mono"
                {...register('sessionId')}
              />
            </div>
            <Button type="submit">{ctaLabel}</Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
