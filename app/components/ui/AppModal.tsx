'use client'

import { useEffect, useId, useRef } from 'react'
import styles from './app-modal.module.css'

export type AppModalActionVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export type AppModalAction = {
  label: string
  variant: AppModalActionVariant
  onClick: () => void
  disabled?: boolean
  autoFocus?: boolean
}

const variantClass: Record<AppModalActionVariant, string> = {
  primary: styles.actionPrimary,
  secondary: styles.actionSecondary,
  ghost: styles.actionGhost,
  danger: styles.actionDanger,
}

type AppModalProps = {
  open: boolean
  title: string
  description?: React.ReactNode
  onClose: () => void
  actions: AppModalAction[]
  /** true면 actions 맨 앞에 닫기(ghost) 배치 */
  leadingClose?: boolean
}

export function AppModal({ open, title, description, onClose, actions, leadingClose }: AppModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      const root = panelRef.current
      if (!root) return
      const focusTarget = root.querySelector<HTMLButtonElement>(
        'button[data-autofocus="true"]'
      )
      const first = focusTarget ?? root.querySelector<HTMLButtonElement>('button')
      first?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open])

  if (!open) return null

  const actionNodes = actions.map((a, i) => (
    <button
      key={`${a.label}-${i}`}
      type="button"
      data-autofocus={a.autoFocus ? 'true' : undefined}
      className={`${styles.actionBtn} ${variantClass[a.variant]}`}
      onClick={a.onClick}
      disabled={a.disabled}
    >
      {a.label}
    </button>
  ))

  return (
    <div className={styles.root} role="presentation">
      <button type="button" className={styles.backdrop} aria-label="닫기" onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.iconClose} aria-label="닫기" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {description ? <div className={styles.body}>{description}</div> : null}
        <div className={styles.actions}>
          {leadingClose ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionGhost} ${styles.actionsLead}`}
              onClick={onClose}
            >
              닫기
            </button>
          ) : null}
          {actionNodes}
        </div>
      </div>
    </div>
  )
}
