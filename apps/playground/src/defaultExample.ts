export const DEFAULT_EXAMPLE = `flowchart TD
    A([用户下单]) --> B{库存充足?}
    B -->|是| C[扣减库存]
    B -.->|否| D[通知补货]
    subgraph 支付
      C ==> E[发起支付]
    end
`
