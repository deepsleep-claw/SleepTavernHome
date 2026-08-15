import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

// 这是结构示例。创建角色卡时必须按用户需要完整替换示例字段。
const Schema = z.object({
  世界: z.object({
    当前时间: z.string().prefault('待初始化'),
  }),
});

$(() => {
  registerMvuSchema(Schema);
});
