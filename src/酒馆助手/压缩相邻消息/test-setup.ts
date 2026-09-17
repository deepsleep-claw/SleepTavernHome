import { klona } from 'klona';
import _ from 'lodash';
import { defineStore } from 'pinia';
import { computed, ref, watch, watchEffect } from 'vue';
import { z } from 'zod';

Object.assign(globalThis, { _, z, klona, defineStore, computed, ref, watch, watchEffect });
