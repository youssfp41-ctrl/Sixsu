import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";

/**
 * QroubatPlugin — stub
 *
 * The "قروبات" command and all group-control commands were moved to
 * ControlPlugin (src/plugins/definitions/control/index.ts).
 * This stub keeps the plugin directory discoverable without registering
 * any commands (which would conflict with ControlPlugin's registrations).
 */
class QroubatPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "qroubat",
    version:     "2.0.0",
    description: "Stub — group commands moved to ControlPlugin.",
    author:      "Sixseven-6677",
  };

  async onLoad(ctx: IPluginContext): Promise<void> {
    ctx.logger.info("QroubatPlugin (stub): all commands handled by ControlPlugin.");
  }
  async onEnable():  Promise<void> { /* no-op */ }
  async onDisable(): Promise<void> { /* no-op */ }
  async onUnload():  Promise<void> { /* no-op */ }
}

export default new QroubatPlugin();
