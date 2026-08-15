---
name: '[mvu_update]变量更新规则'
enabled: true
position:
  type: at_depth
  role: system
  depth: 0
  order: 14720
recursion:
  prevent_incoming: true
  prevent_outgoing: true
  delay_until: null
---
# 这是规则形状示例。创建角色卡时必须依据Schema和用户要求完整替换。
变量更新规则:
  世界:
    当前时间:
      format: YYYY-MM-DD HH:mm
      check:
        - 事件推进、休息、旅行或场景明确跳转后更新
