import ReportView from './ReportView'

type ReportPageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function ReportPage({ searchParams = {} }: ReportPageProps) {
  const raw = searchParams.preview
  const initialPreview = raw === '1' || (Array.isArray(raw) && raw[0] === '1')
  return <ReportView initialPreview={initialPreview} />
}
