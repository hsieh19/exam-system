const https = require('https');

class FeishuService {
    constructor() {
        this.appId = process.env.FEISHU_APP_ID;
        this.appSecret = process.env.FEISHU_APP_SECRET;
    }

    /**
     * 发起 HTTPS 请求的辅助方法
     */
    request(options, data) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed.code !== 0) {
                            reject(new Error(`Feishu API Error: ${parsed.msg || 'Unknown error'} (code: ${parsed.code})`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error('Failed to parse Feishu response'));
                    }
                });
            });

            req.on('error', (e) => reject(e));

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    /**
     * 获取 app_access_token
     */
    async getAppAccessToken() {
        const options = {
            hostname: 'open.feishu.cn',
            path: '/open-apis/auth/v3/app_access_token/internal',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        };

        const data = {
            app_id: this.appId,
            app_secret: this.appSecret
        };

        const result = await this.request(options, data);
        return result.app_access_token;
    }

    /**
     * 通过 code 换取用户信息 (v1 接口，适用于 H5 应用)
     * result.data 包含 access_token, open_id, user_id, name, avatar_url 等
     */
    async getUserInfo(code, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: '/open-apis/authen/v1/access_token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${appAccessToken}`
            }
        };

        const data = {
            grant_type: 'authorization_code',
            code: code
        };

        const result = await this.request(options, data);
        return result.data;
    }

    /**
     * 获取用户详细信息 (获取部门 ID)
     * 需要权限: contact:user.base:readonly
     */
    async getUserDetails(userId, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/contact/v3/users/${userId}?user_id_type=open_id`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${appAccessToken}`
            }
        };

        const result = await this.request(options);
        return result.data.user;
    }

    /**
     * 获取部门信息
     * 需要权限: contact:department.base:readonly
     */
    async getDepartmentInfo(departmentId, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/contact/v3/departments/${departmentId}?department_id_type=open_department_id`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${appAccessToken}`
            }
        };

        const result = await this.request(options);
        return result.data.department;
    }
    /**
     * 获取根部门下的子部门列表
     * 需要权限: contact:contact.base:readonly
     */
    async getDepartmentChildren(parentDeptId, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            // 指定 open_department_id 类型，确保返回完整的部门信息（包含 name）
            path: `/open-apis/contact/v3/departments?parent_department_id=${parentDeptId}&department_id_type=open_department_id&fetch_child=true&page_size=50`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${appAccessToken}`
            }
        };
        const result = await this.request(options);
        return result.data.items || [];
    }

    /**
     * 获取某部门下的直属成员 open_id 列表
     * 需要权限: contact:contact.base:readonly
     */
    async getDepartmentMembers(deptId, appAccessToken) {
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/contact/v3/users/find_by_department?department_id=${deptId}&department_id_type=open_department_id&page_size=50`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${appAccessToken}`
            }
        };
        const result = await this.request(options);
        return (result.data.items || []).map(u => u.open_id);
    }

    /**
     * 构建 open_id -> 部门名称 的映射表
     * 递归遍历所有部门
     */
    async buildOpenIdToDeptMap(appAccessToken) {
        const map = {}; // { open_id: deptName }
        const queue = ['0']; // 从根部门开始（0 = 根）

        while (queue.length > 0) {
            const parentId = queue.shift();
            let depts = [];
            try {
                depts = await this.getDepartmentChildren(parentId, appAccessToken);
            } catch (e) {
                console.warn(`[FeishuSync] getDepartmentChildren failed for ${parentId}:`, e.message);
                continue;
            }

            for (const dept of depts) {
                // 兼容两种字段名：飞书有时用 open_department_id，有时用 department_id
                const deptOpenId = dept.open_department_id || dept.department_id;
                const deptName = dept.name;
                if (!deptOpenId || !deptName) {
                    console.warn('[FeishuSync] Skipping dept with missing id/name:', JSON.stringify(dept));
                    continue;
                }
                // 拉取该部门的直属成员
                try {
                    const members = await this.getDepartmentMembers(deptOpenId, appAccessToken);
                    for (const openId of members) {
                        if (!openId) continue;
                        if (!map[openId]) map[openId] = [];
                        if (!map[openId].includes(deptName)) {
                            map[openId].push(deptName);
                        }
                    }
                } catch (e) {
                    console.warn(`[FeishuSync] getDepartmentMembers failed for ${deptName}:`, e.message);
                }
                // 把这个部门放入队列，继续查子部门
                queue.push(deptOpenId);
            }
        }
        return map;
    }
}

module.exports = new FeishuService();
