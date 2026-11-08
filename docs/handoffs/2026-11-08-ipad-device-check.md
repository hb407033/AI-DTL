# 2026-11-08 真机安装核对

分支仍是 `cursor/ipad-realtime-guided-dialogue-93b6`。没有改设备信任，没有改签名凭据，没有动家庭作品库 `workspaces-v2`，没有发放或领取密钥，没有 SSH mini，没有在 mini 上跑探针、起服务或部署。没有装 Release，也没有把 `realtimeMode` 默认改成开。

## 认到的设备

当时 Mac 上：

| 设备 | 标识 | 状态 | 处理 |
| --- | --- | --- | --- |
| 珩pad，iPad Pro 11 英寸第四代（iPad14,3） | `00008112-000509D9268A201E` | 物理设备，已配对，已连接，已开机，开机后处于解锁 | 只对这一台安装 |
| Bin's iPhone，iPhone 15 Pro Max | `00008130-00020C6101A1001C` | unavailable | 没有安装 |

配对方式是 manualPairing。锁屏查询结果是 `unlockedSinceBoot: true`。安装脚本里的设备标识就是这台 iPad，不会装到 iPhone。

## 已执行

命令：

`CONFIG=Debug tools/install-ipad-company-signed.sh`

结果（`/tmp/ipad-debug-install.log`）：

- `** BUILD SUCCEEDED **`
- 使用仓库脚本里已有的公司通配描述文件，到期 2027-10-07
- `App installed:`
- `Launched application with com.houbin.aischolar.pad bundle identifier.`

装完之后在这台 iPad 上看到应用 `AI-DTL` / `com.houbin.aischolar.pad`，版本 1.0（1），进程已起来。这次启动没有带 `-realtimeMode YES`，默认开关仍是关。

## 没有测，也不能当成测过

5 类题对照和四项真机门槛都没有跑。`tools/device-teaching-case.sh` 和 `tools/device-realtime-case.sh` 都会 SSH 到 `hb-mini@10.10.10.6`，在 mini 上启动隔离验收宿主，再从 8797 给 iPad 送孩子音频。这次明确不能 SSH、不能在 mini 起服务。没有用本机 8791 上的家庭宿主代替，也没有改脚本去绕开 mini。

所以下面四项都还是未测：说完到出声的中位数是否 ≤ 4 秒、抢答/口诀是否不多于 v16、慢路径是否 ≤ 30%、token 是否不超过 v16 的一半。家长亲自开麦确认也没有代做。

## 下一步需要的最小授权

1. 明确允许这一次 SSH 到 `hb-mini@10.10.10.6`，只启动仓库里现有的隔离验收宿主（端口 8797/8798，目录用新的 `acceptance/device-*`）。不碰 `workspaces-v2`，不部署，不改 mini 开机配置。跑完就停。
2. 用现有 5 类题的照片和台词，各跑一遍 `tools/device-teaching-case.sh`（v16）和 `tools/device-realtime-case.sh`（只对这一次带 `-realtimeMode YES`，不改默认开关）。
3. 实时那一半还要 iPad 上已经有家长领过的密钥。如果没有，需要家长另行同意发放一次口令，并由家长自己在 iPad 上输入。不要代发、代领。
4. 四项门槛都有真实记录，并且家长自己开麦确认过节奏之后，才讨论把默认开关打开和装 Release。
