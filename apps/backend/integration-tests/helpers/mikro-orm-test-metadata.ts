import { MetadataStorage } from "@mikro-orm/core"

export function resetMikroOrmGlobalMetadataForTestRealm(): void {
  MetadataStorage.clear()
}
