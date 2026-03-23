import styles from './preview-banner.module.css'

type PreviewModeBannerProps = {
  children: string
}

export function PreviewModeBanner({ children }: PreviewModeBannerProps) {
  return (
    <div className={styles.banner} role="status">
      {children}
    </div>
  )
}
