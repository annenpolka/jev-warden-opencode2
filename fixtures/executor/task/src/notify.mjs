export async function notifyUser(event, transport) {
  await transport.send(`event:${event.id}`)
}
