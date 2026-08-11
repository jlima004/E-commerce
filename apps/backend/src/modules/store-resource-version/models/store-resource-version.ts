import { model } from "@medusajs/framework/utils"

const StoreResourceVersion = model
  .define("store_resource_version", {
    id: model.id({ prefix: "strver" }).primaryKey(),
    resource_type: model.text(),
    resource_id: model.text(),
    version: model.number().default(1),
  })
  .indexes([
    {
      name: "UQ_store_resource_version_resource",
      on: ["resource_type", "resource_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])
  .checks([
    {
      name: "store_resource_version_version_check",
      expression: (columns) => `${columns.version} > 0`,
    },
  ])

export default StoreResourceVersion
