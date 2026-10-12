import { EmptyState } from '../../components/EmptyState/EmptyState'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import styles from '../Page.module.css'

export function ProjectsPage() {
  useDocumentTitle('Projects')

  return (
    <div className={styles.stack}>
      <PageHeader title="Projects" />
      <EmptyState title="No projects yet.">Project management is built in a later phase.</EmptyState>
    </div>
  )
}
