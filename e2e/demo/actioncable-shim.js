export function createConsumer() { return { subscriptions: { create: () => ({ perform() {}, unsubscribe() {} }) }, disconnect() {} }; }
