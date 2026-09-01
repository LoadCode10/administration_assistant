import client from './client'

export function listProcedures(params = {}) {
  return client.get('/procedures', { params }).then((r) => r.data)
}

export function getProcedure(id) {
  return client.get(`/procedures/${id}`).then((r) => r.data)
}
