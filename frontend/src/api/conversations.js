import client from './client'

export function createConversation() {
  return client.post('/conversations').then((r) => r.data)
}

export function listConversations() {
  return client.get('/conversations').then((r) => r.data)
}

export function getConversation(id) {
  return client.get(`/conversations/${id}`).then((r) => r.data)
}

export function deleteConversation(id) {
  return client.delete(`/conversations/${id}`)
}

export function sendMessage(conversationId, payload) {
  return client.post(`/conversations/${conversationId}/messages`, payload).then((r) => r.data)
}

export function editMessage(conversationId, questionId, questionContent) {
  return client
    .patch(`/conversations/${conversationId}/questions/${questionId}`, {
      question_content: questionContent,
    })
    .then((r) => r.data)
}

export function deleteMessage(conversationId, questionId) {
  return client.delete(`/conversations/${conversationId}/questions/${questionId}`)
}
