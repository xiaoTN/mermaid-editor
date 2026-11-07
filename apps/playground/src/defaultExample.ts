export const DEFAULT_EXAMPLE = `---
config:
  flowchart:
    nodeSpacing: 24
    rankSpacing: 24
---
flowchart LR
    %% 双击节点、分组标题或连线文字，可以直接改字。
    %% 单击节点，可切换形状、修改填充色/边框色/文字色、复制或删除。
    %% 拖动蓝点新建连线；拖动箭头端点修改连接对象。
    %% 拖节点可调整分组或同层分支顺序，等画布对照预览完成后松手应用。
    %% 试试调整「练习用节点」「短信通知」「站内通知」的顺序；也可单击节点用「分支前移/后移」。
    %% 拖分组标题、边框或空白可整组移动；试试交换两个通知组，或把「履约分组」拖出「支付分组」。
    %% Shift 多选或使用框选，可批量改样式，再点「+ 分组」将节点归组。
    %% 试试解散分组、切换方向、缩放、平移、收起源码，以及撤销/重做。
    %% 点「保存」下载文件，再用「打开」或拖入文件，检查内容是否保留。

    A([开始体验])
    subgraph intake[接单分组]
      B["提交订单<br/>双击这里改字"]
      C{库存充足？}
      D(通知补货)
    end

    subgraph payment[支付分组]
      E[[发起支付]]
      F{{风控校验}}
      subgraph fulfillment[履约分组]
        G[(订单数据库)]
        H((订单完成))
      end
    end

    subgraph email[邮件通知组]
      M[发送邮件]
    end
    subgraph client[客户端通知组]
      N[推送到客户端]
    end

    I[人工处理]
    J[练习用节点]
    K[短信通知]
    L[站内通知]

    A --> B
    B --> C
    C -->|有货| E
    C -.->|缺货| D
    E ==>|支付成功| F
    F -->|通过| G
    G --> H
    D --x I
    F --o I
    I <-->|双向沟通| J
    H --- J
    intake -.->|分组连线| payment
    H --> K
    H --> L
    J --> M
    J --> N

    %% 共享配色和单独配色都可在画布上继续修改。
    classDef normal fill:#eff6ff,stroke:#315fd6,color:#25334a
    classDef warning fill:#fff4d6,stroke:#b7791f,color:#713f12
    classDef success fill:#e9f8ef,stroke:#218359,color:#14532d
    class A,B,E,G normal
    class C,D,F warning
    class H success
    style I fill:#fff1f2,stroke:#be123c,color:#881337
    style intake fill:#f8fafc,stroke:#94a3b8
    style payment fill:#f0f7ff,stroke:#6d92df
    style fulfillment fill:#ffffff,stroke:#9bb0ca,stroke-dasharray:4 4
    linkStyle 4 stroke:#315fd6,stroke-width:3px
`
