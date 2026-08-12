import { describe,expect,it } from 'vitest';
import { createPortalSession,parsePortalSession } from './session.js';
const key=Buffer.alloc(32,7).toString('base64');
describe('portal session',()=>{
 it('ký và đọc tenant session',()=>{const value=createPortalSession('user-1','tenant-1',key),session=parsePortalSession(`x=y; ggpay_portal=${value}`,key);expect(session?.userId).toBe('user-1');expect(session?.tenantId).toBe('tenant-1');expect(session?.csrf).toBeTruthy();});
 it('từ chối session bị sửa',()=>{const value=createPortalSession('user-1','tenant-1',key);expect(parsePortalSession(`ggpay_portal=${value}x`,key)).toBeNull();});
});
