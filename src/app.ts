import express from 'express';
import { receiverRoutes } from './receiver/routes.js';
import { reportRoutes } from './report/routes.js';
import { sinkRoutes } from './sink/routes.js';

export function createApp(): express.Express {
  const app = express(); app.set('trust proxy',true);
  app.use(sinkRoutes()); app.use(express.json({limit:'256kb'})); app.use(receiverRoutes()); app.use(reportRoutes());
  app.get('/health',(_req,res) => res.json({ok:true}));
  app.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => { console.error(error); res.status(500).json({success:false,message:'internal error'}); });
  return app;
}
