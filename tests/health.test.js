import supertest from 'supertest';
import app from '../app.js';

it('does not report ready before startup verifies its dependencies', async () => {
  app.locals.dependenciesReady = false;
  expect((await supertest(app).get('/health')).status).toBe(503);
});

it('reports ready after the dependency checks have passed', async () => {
  app.locals.dependenciesReady = true;
  const response = await supertest(app).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ready' });
  app.locals.dependenciesReady = false;
});

it('does not claim readiness when a later dependency probe fails', async () => {
  app.locals.dependenciesReady = true;
  app.locals.checkDependencies = async () => { throw new Error('fixture outage'); };
  expect((await supertest(app).get('/health')).status).toBe(503);
  delete app.locals.checkDependencies;
  app.locals.dependenciesReady = false;
});
