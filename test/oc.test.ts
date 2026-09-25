import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  leer_paquete,
  validar,
} from "../src/tools/oc.js";

import type {
  Paquete,
  Validacion,
} from "../src/types.js";

type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const root = path.resolve(
  path.dirname(
    fileURLToPath(import.meta.url)
  ),
  ".."
);

function parse<T>(
  value: string
): ToolResult<T> {
  return JSON.parse(value) as ToolResult<T>;
}

async function validarCaso(
  caso: string
): Promise<Validacion> {
  const ctx = {
    directory: root,
    sessionId: `test-${caso}`,
  };

  const paqueteResult =
    parse<Paquete>(
      await leer_paquete.execute(
        { caso },
        ctx
      )
    );

  assert.equal(
    paqueteResult.ok,
    true,
    `No fue posible leer ${caso}: ${paqueteResult.error ?? ""}`
  );

  assert.ok(
    paqueteResult.data,
    `${caso} debe contener un paquete`
  );

  const validacionResult =
    parse<Validacion>(
      await validar.execute(
        {
          caso,
          paquete:
            paqueteResult.data,
        },
        ctx
      )
    );

  assert.equal(
    validacionResult.ok,
    true,
    `No fue posible validar ${caso}: ${validacionResult.error ?? ""}`
  );

  assert.ok(
    validacionResult.data,
    `${caso} debe producir una validación`
  );

  return validacionResult.data;
}

test(
  "sol-001 es apta y no requiere confirmación",
  async () => {
    const result =
      await validarCaso(
        "sol-001"
      );

    assert.equal(
      result.apta,
      true
    );

    assert.equal(
      result.bloqueos.length,
      0
    );

    assert.equal(
      result.confirmaciones.length,
      0
    );

    assert.equal(
      result.retroactiva,
      false
    );
  }
);

test(
  "sol-002 se bloquea por RC1 proveedor inexistente o inactivo",
  async () => {
    const result =
      await validarCaso(
        "sol-002"
      );

    assert.equal(
      result.apta,
      false
    );

    assert.ok(
      result.bloqueos.some(
        (item) =>
          item.codigo === "RC1"
      )
    );
  }
);

test(
  "sol-003 se bloquea por RC2 aprobación inválida",
  async () => {
    const result =
      await validarCaso(
        "sol-003"
      );

    assert.equal(
      result.apta,
      false
    );

    assert.ok(
      result.bloqueos.some(
        (item) =>
          item.codigo === "RC2"
      )
    );
  }
);

test(
  "sol-004 requiere confirmación por RC5",
  async () => {
    const result =
      await validarCaso(
        "sol-004"
      );

    assert.equal(
      result.apta,
      true
    );

    assert.ok(
      result.confirmaciones.some(
        (item) =>
          item.codigo === "RC5"
      )
    );
  }
);

test(
  "sol-005 se marca retroactiva y requiere confirmación RC8",
  async () => {
    const result =
      await validarCaso(
        "sol-005"
      );

    assert.equal(
      result.apta,
      true
    );

    assert.equal(
      result.retroactiva,
      true
    );

    assert.ok(
      result.confirmaciones.some(
        (item) =>
          item.codigo === "RC8"
      )
    );
  }
);

test(
  "sol-006 requiere confirmación RC6 por IVA ausente",
  async () => {
    const result =
      await validarCaso(
        "sol-006"
      );

    assert.equal(
      result.apta,
      true
    );

    assert.ok(
      result.confirmaciones.some(
        (item) =>
          item.codigo === "RC6"
      )
    );

    assert.ok(
      result.derivados
    );
  }
);