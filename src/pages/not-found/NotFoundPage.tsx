import { Link } from 'react-router'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import styles from '../Page.module.css'

export function NotFoundPage() {
  useDocumentTitle('Page not found')

  return (
    <div className={styles.stack}>
      <PageHeader title="Page not found" lead="There is nothing at this address." />
      <p className={styles.body}>
        <Link to="/" className={styles.link}>
          Back to Mission Control
        </Link>
      </p>
    </div>
  )
}
