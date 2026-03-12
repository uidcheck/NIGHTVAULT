const express = require('express');

const ROUTER_METHODS = ['all', 'get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'use'];
const ROUTE_METHODS = ['all', 'get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
const WRAPPED_HANDLER = Symbol('wrappedAsyncHandler');

function isPromiseLike(value) {
  return !!value && typeof value.then === 'function';
}

function isExpressRouter(value) {
  return typeof value === 'function'
    && typeof value.use === 'function'
    && typeof value.handle === 'function'
    && Array.isArray(value.stack);
}

function wrapAsyncHandler(handler) {
  if (typeof handler !== 'function') {
    return handler;
  }

  if (handler.length === 4 || handler[WRAPPED_HANDLER] || isExpressRouter(handler)) {
    return handler;
  }

  function wrappedAsyncHandler(req, res, next) {
    try {
      const result = handler.call(this, req, res, next);
      if (isPromiseLike(result)) {
        result.catch(next);
      }
      return result;
    } catch (err) {
      return next(err);
    }
  }

  wrappedAsyncHandler[WRAPPED_HANDLER] = true;
  return wrappedAsyncHandler;
}

function wrapHandlers(args) {
  return args.map((arg) => {
    if (Array.isArray(arg)) {
      return wrapHandlers(arg);
    }

    return wrapAsyncHandler(arg);
  });
}

function patchRoute(route) {
  for (const method of ROUTE_METHODS) {
    const originalMethod = route[method].bind(route);
    route[method] = (...args) => originalMethod(...wrapHandlers(args));
  }

  return route;
}

function createAsyncRouter(options) {
  const router = express.Router(options);

  for (const method of ROUTER_METHODS) {
    const originalMethod = router[method].bind(router);
    router[method] = (...args) => originalMethod(...wrapHandlers(args));
  }

  const originalRoute = router.route.bind(router);
  router.route = (...args) => patchRoute(originalRoute(...args));

  return router;
}

module.exports = {
  createAsyncRouter,
  wrapAsyncHandler,
};