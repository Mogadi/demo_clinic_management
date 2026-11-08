export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function mapDbError(error) {
  if (!error?.code) return error;
  if (error.code === '23505') return httpError(409, 'That record already exists');
  if (error.code === '23503') return httpError(400, 'A related record is missing or still in use');
  if (error.code === '23P01') return httpError(409, 'That doctor already has an appointment in this time slot');
  if (error.code === '22P02' || error.code === '22007' || error.code === '22008') {
    return httpError(400, 'A date or number in that request is not valid');
  }
  if (error.code === 'P0001' || error.code === '23514') {
    const message = String(error.message || 'The database rejected that change').split('\n')[0];
    return httpError(409, message);
  }
  return error;
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function clean(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}
