---
name: '[mvu_update]变量输出格式'
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
变量输出格式:
  rule:
    - you must output the update analysis and the actual update commands at once in the end of the next reply
    - the update commands work like JSON Patch (RFC 6902) and must be a valid JSON array
    - supported operations are replace, delta, insert, remove and move
    - don't update field names starting with `_`, because they are readonly
  format: |-
    <UpdateVariable>
    <Analysis>$(IN ENGLISH, no more than 80 words)
    - ${calculate time passed: ...}
    - ${analyze every variable according only to the current reply and its check rules: ...}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },
      { "op": "delta", "path": "${/path/to/number}", "value": "${positive_or_negative_delta}" },
      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },
      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },
      { "op": "remove", "path": "${/path/to/object/key}" },
      { "op": "move", "from": "${/old/path}", "to": "${/new/path}" }
    ]
    </JSONPatch>
    </UpdateVariable>
