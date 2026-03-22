'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type ChromeNavVisibilityValue = {
  hideHamburger: boolean
  setHideHamburger: (hide: boolean) => void
}

const ChromeNavVisibilityContext = createContext<ChromeNavVisibilityValue | null>(null)

export function ChromeNavVisibilityProvider({ children }: { children: ReactNode }) {
  const [hideHamburger, setHideHamburger] = useState(false)
  const value = useMemo(
    () => ({ hideHamburger, setHideHamburger }),
    [hideHamburger]
  )
  return (
    <ChromeNavVisibilityContext.Provider value={value}>{children}</ChromeNavVisibilityContext.Provider>
  )
}

export function useChromeNavVisibility(): ChromeNavVisibilityValue {
  const ctx = useContext(ChromeNavVisibilityContext)
  if (!ctx) {
    throw new Error('useChromeNavVisibility must be used within ChromeNavVisibilityProvider')
  }
  return ctx
}
