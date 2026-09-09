// @ts-check
/**
 * The machine ForgeLocal is written against.
 *
 * The build sizes models against it and so does the loader dialog in the
 * browser, so the numbers live in core where both import them. Two copies is
 * how one page ends up saying a model fits while another says it does not.
 *
 * A real desktop build replaces this with a hardware probe; nothing here
 * pretends to have detected anything.
 */
import { GB } from "./units.mjs";

/**
 * @typedef {object} MachineProfile
 * @property {string} id
 * @property {string} label
 * @property {string} gpu
 * @property {number} vramBytes
 * @property {number} ramBytes
 * @property {number} ramFreeBytes
 * @property {number} diskFreeBytes
 * @property {string} os
 * @property {number} cores
 * @property {number} threads
 */

/** @type {MachineProfile} */
export const THIS_PC = {
  id: "rtx4070-12gb-32gb",
  label: "RTX 4070 12 GB, 32 GB RAM",
  gpu: "NVIDIA GeForce RTX 4070",
  vramBytes: 12 * GB,
  ramBytes: 32 * GB,
  ramFreeBytes: 19 * GB,
  diskFreeBytes: 248 * GB,
  os: "Windows 11, 64-bit",
  cores: 16,
  threads: 16,
};
