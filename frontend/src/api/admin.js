import client from './client'

export function createProcedure(payload) {
  return client.post('/admin/procedures', payload).then((r) => r.data)
}

export function updateProcedure(id, payload) {
  return client.patch(`/admin/procedures/${id}`, payload).then((r) => r.data)
}

export function deleteProcedure(id) {
  return client.delete(`/admin/procedures/${id}`)
}

export function uploadExtraction(files) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  // Let the browser/axios set Content-Type itself — it needs to generate the
  // multipart boundary, which a manually-set header would suppress.
  return client.post('/admin/extract', formData).then((r) => r.data)
}

export function listStagings(statusFilter = 'pending') {
  return client.get('/admin/extract', { params: { status_filter: statusFilter } }).then((r) => r.data)
}

export function getStaging(id) {
  return client.get(`/admin/extract/${id}`).then((r) => r.data)
}

export function updateStaging(id, extractedData) {
  return client.patch(`/admin/extract/${id}`, { extracted_data: extractedData }).then((r) => r.data)
}

export function validateStaging(id) {
  return client.post(`/admin/extract/${id}/validate`).then((r) => r.data)
}

export function rejectStaging(id) {
  return client.post(`/admin/extract/${id}/reject`).then((r) => r.data)
}
