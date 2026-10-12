import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  lead?: string
}

/** The title block at the top of a standard page. */
export function PageHeader({ title, lead }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {lead && <p className={styles.lead}>{lead}</p>}
    </header>
  )
}
