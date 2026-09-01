import client from './client'

export function ask(payload) {
  return client.post('/ask', payload).then((r) => r.data)
}
