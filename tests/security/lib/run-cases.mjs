/**
 * Runs every check against a database and reports passed or failed for each.
 *
 * "db" is anything with exec(sql) and query(sql) that returns
 * { rows, affectedRows }. Each check runs in its own transaction: load the
 * made-up records as administrator, switch to the identity being tested the
 * same way the Supabase Data API does, run the statement, then roll
 * everything back.
 */
export async function runCases(db, { cases, identities, seedSql }) {
  const results = []

  for (const testCase of cases) {
    const identity = identities[testCase.identity]
    let outcome

    await db.exec('begin')
    try {
      await db.exec(seedSql)
      await db.exec(`set local role ${identity.role}`)
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ])
      try {
        const result = await db.query(testCase.sql)
        outcome = { rows: result.rows ?? [], affected: result.affectedRows ?? 0 }
      } catch (error) {
        outcome = { error: { code: error.code, message: String(error.message) } }
      }
    } catch (error) {
      outcome = { setupError: String(error.message) }
    } finally {
      await db.exec('rollback')
    }

    const problem = judge(testCase.expect, outcome)
    results.push({
      id: testCase.id,
      identity: identity.label,
      title: testCase.title,
      status: problem ? 'failed' : 'passed',
      detail: problem ?? '',
    })
  }

  return results
}

/** Returns null when the outcome matches what was expected, otherwise the reason it does not. */
function judge(expect, outcome) {
  if (outcome.setupError) return `could not set up the check: ${outcome.setupError}`

  if (expect.errorCode) {
    if (!outcome.error) {
      return `expected to be refused, but it was allowed (${outcome.rows.length} rows returned, ${outcome.affected} changed)`
    }
    if (outcome.error.code !== expect.errorCode) {
      return `expected error ${expect.errorCode}, got ${outcome.error.code}: ${outcome.error.message}`
    }
    if (expect.errorMatch && !expect.errorMatch.test(outcome.error.message)) {
      return `refused for the wrong reason: ${outcome.error.message}`
    }
    return null
  }

  if (outcome.error) return `unexpected error ${outcome.error.code}: ${outcome.error.message}`

  if (expect.rows !== undefined && outcome.rows.length !== expect.rows) {
    return `expected ${expect.rows} rows, got ${outcome.rows.length}`
  }
  if (expect.affected !== undefined && outcome.affected !== expect.affected) {
    return `expected ${expect.affected} rows changed, got ${outcome.affected}`
  }
  if (expect.verify) return expect.verify(outcome.rows)
  return null
}
