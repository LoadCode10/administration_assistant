import client from './client'

export function startProcedure(procedureId) {
  return client.post(`/procedures/${procedureId}/start`).then((r) => r.data)
}

export function listMyProcedures() {
  return client.get('/me/procedures').then((r) => r.data)
}

export function getMyProcedure(id) {
  return client.get(`/me/procedures/${id}`).then((r) => r.data)
}

export function toggleEtape(userProcedureId, etapeId, isDone) {
  return client
    .patch(`/me/procedures/${userProcedureId}/etapes/${etapeId}`, { is_done: isDone })
    .then((r) => r.data)
}

export function togglePiece(userProcedureId, pieceId, isDone) {
  return client
    .patch(`/me/procedures/${userProcedureId}/pieces/${pieceId}`, { is_done: isDone })
    .then((r) => r.data)
}
