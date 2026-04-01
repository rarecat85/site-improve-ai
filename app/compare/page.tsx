import CompareView from './CompareView'

type ComparePageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function ComparePage({ searchParams = {} }: ComparePageProps) {
  const raw = searchParams.preview
  const initialPreview = raw === '1' || (Array.isArray(raw) && raw[0] === '1')
  return <CompareView initialPreview={initialPreview} />
}
