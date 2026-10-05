export const id = 'A-AUTHZ-001'
export const title = '跨所有者按 id 直接访问被 404 拒绝，且不改变数据、不泄漏存在性'

export default async function run(api) {
  const server = await api.startServer()
  try {
    const created = (await api.request(server, {
      method: 'POST',
      path: '/api/v1/todos',
      token: 'alice-secret',
      body: { title: "alice's secret plan", notes: 'private', done: false },
    })).body
    const path = `/api/v1/todos/${created.id}`
    const bobRead = await api.request(server, { method: 'GET', path, token: 'bob-secret' })
    const bobPatch = await api.request(server, { method: 'PATCH', path, token: 'bob-secret', body: { title: 'hijacked' } })
    const bobPut = await api.request(server, {
      method: 'PUT',
      path,
      token: 'bob-secret',
      body: { title: 'hijacked', done: true },
    })
    const bobDelete = await api.request(server, { method: 'DELETE', path, token: 'bob-secret' })
    const aliceRead = await api.request(server, { method: 'GET', path, token: 'alice-secret' })
    const alicePatch = await api.request(server, { method: 'PATCH', path, token: 'alice-secret', body: { done: true } })
    // Read the representation after the owner's own write: nothing above may have changed
    // the row, so only this PATCH can have advanced the version.
    const aliceAfterPatch = await api.request(server, { method: 'GET', path, token: 'alice-secret' })
    return { created, bobRead, bobPatch, bobPut, bobDelete, aliceRead, alicePatch, aliceAfterPatch }
  } finally {
    await api.stopServer(server)
  }
}

export function assertions(observed) {
  const status = (r) => (r ? r.status : null)
  const code = (r) => r && r.body && r.body.error && r.body.error.code
  const bodyText = (r) => (r ? String(r.bodyText || '') : '')
  const after = observed.aliceRead && observed.aliceRead.body
  const original = observed.created || {}
  const crossOwner = [observed.bobRead, observed.bobPatch, observed.bobPut, observed.bobDelete]
  return [
    ['a different owner\'s direct object-id access is rejected with 404 not_found', crossOwner.every((r) => status(r) === 404 && code(r) === 'not_found'), `statuses=${JSON.stringify(crossOwner.map((r) => [status(r), code(r)]))}`],
    ['cross-owner access reveals no task body', crossOwner.every((r) => !bodyText(r).includes('secret plan') && !bodyText(r).includes('alice-secret')), `bodies=${JSON.stringify(crossOwner.map(bodyText))}`],
    ['the owner can read and change its own task', status(observed.aliceRead) === 200 && status(observed.alicePatch) === 200, `read=${status(observed.aliceRead)} patch=${status(observed.alicePatch)}`],
    ['cross-owner access changes no field of the task', Boolean(after) && after.title === original.title && after.notes === original.notes && after.owner_id === 'alice', `after=${JSON.stringify(after)}`],
    ['only the owner\'s own PATCH advanced the version', Boolean(observed.aliceAfterPatch && observed.aliceAfterPatch.body) && observed.aliceAfterPatch.body.version === 2 && observed.aliceAfterPatch.body.done === true, `after=${JSON.stringify(observed.aliceAfterPatch && observed.aliceAfterPatch.body)}`],
  ]
}
