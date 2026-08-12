import express from 'express';
import { adminRoutes } from './admin/routes.js';
import { customerRoutes } from './customer/routes.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { portalRoutes } from './portal/routes.js';
import { receiverRoutes } from './receiver/routes.js';
import { reportRoutes } from './report/routes.js';
import { sinkRoutes } from './sink/routes.js';

export function createApp(): express.Express {
  const app = express(); app.set('trust proxy',true);
  app.use(sinkRoutes()); app.use(dashboardRoutes()); app.use(portalRoutes()); app.use(express.json({limit:'256kb'})); app.use(adminRoutes()); app.use(customerRoutes()); app.use(receiverRoutes()); app.use(reportRoutes());
  app.get('/health', async (_req,res) => {
    try {
      const { pool } = await import('./db/pool.js');
      await pool.query('select 1');
      res.json({ok:true,database:'ok'});
    } catch (error) {
      console.error('health check database lỗi:',error);
      res.status(503).json({ok:false,database:'error'});
    }
  });
  app.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => { console.error(error); res.status(500).json({success:false,message:'internal error'}); });
  return app;
}
