export async function processTransfer() {
  throw { status: 503, message: 'Payment execution is unavailable during service restoration' };
}
