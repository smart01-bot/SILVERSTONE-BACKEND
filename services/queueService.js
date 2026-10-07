export async function getNextRequest() {
  throw { status: 503, message: 'The legacy Redis worker is incompatible with the live transfer lifecycle' };
}
