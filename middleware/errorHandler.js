const errorHandler = (error, req, res, next) => {
  const status = error.status || 500;
  const message = status >= 500 ? 'Internal server error' : (error.message || 'Request failed');
  console.error(`Error: ${message} (Status: ${status})`); // Log error for debugging
  res.status(status).json({ error: message });

};

export default errorHandler;