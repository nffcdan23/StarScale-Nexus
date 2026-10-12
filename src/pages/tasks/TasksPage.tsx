import { EmptyState } from '../../components/EmptyState/EmptyState'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import styles from '../Page.module.css'

export function TasksPage() {
  useDocumentTitle('Tasks')

  return (
    <div className={styles.stack}>
      <PageHeader title="Tasks" />
      <EmptyState title="No tasks yet.">Task management is built in a later phase.</EmptyState>
    </div>
  )
}
