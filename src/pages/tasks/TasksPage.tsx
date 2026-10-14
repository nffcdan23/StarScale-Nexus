import { EmptyState } from '../../components/EmptyState/EmptyState'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { ContextsManager } from '../../features/contexts/ContextsManager'
import { useContexts } from '../../features/contexts/useContexts'
import { TasksPanel } from '../../features/tasks/TasksPanel'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import styles from './TasksPage.module.css'

export function TasksPage() {
  useDocumentTitle('Tasks')
  const contexts = useContexts()
  const needsFirstContext = !contexts.loading && !contexts.error && contexts.active.length === 0

  return (
    <div className={styles.page}>
      <PageHeader title="Tasks" />
      <div className={styles.layout}>
        {needsFirstContext ? (
          <EmptyState title="Create a context first.">
            Every task belongs to a context, such as Personal or StarScale. Add one in the Contexts panel.
          </EmptyState>
        ) : (
          <TasksPanel contexts={contexts.all} />
        )}
        <ContextsManager contexts={contexts} />
      </div>
    </div>
  )
}
