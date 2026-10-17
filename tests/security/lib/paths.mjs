import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Worked out from this file's own location, so nothing depends on where the
// project folder sits or on which operating system it is.
export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const reportPath = join(projectRoot, 'docs', 'security-report.md')
export const realResultsPath = join(projectRoot, 'tests', 'security', 'real', 'results.json')
export const cloudResultsPath = join(projectRoot, 'tests', 'security', 'cloud', 'results.json')
export const cloudLiveResultsPath = join(projectRoot, 'tests', 'security', 'cloud', 'live-results.json')
export const cloudReportPath = join(projectRoot, 'docs', 'cloud-security-report.md')
export const imitationPath = join(projectRoot, 'tests', 'security', 'mock', 'supabase-imitation.sql')
