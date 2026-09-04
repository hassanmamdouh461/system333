import { describe, it, expect } from 'vitest';
import {
  normalizeUnit,
  convertToBaseQuantity,
  convertFromBaseQuantity,
  getInitialDisplayUnitAndQty,
} from './unitConversion';

describe('unitConversion', () => {
  describe('normalizeUnit', () => {
    it('normalizes Arabic and English unit synonyms', () => {
      expect(normalizeUnit('كجم')).toBe('kg');
      expect(normalizeUnit('كيلو')).toBe('kg');
      expect(normalizeUnit('جرام')).toBe('g');
      expect(normalizeUnit('لتر')).toBe('liter');
      expect(normalizeUnit('مل')).toBe('ml');
      expect(normalizeUnit('قطعة')).toBe('piece');
    });
  });

  describe('convertToBaseQuantity', () => {
    it('converts grams to kilograms correctly', () => {
      // 250 g to kg = 0.25 kg
      expect(convertToBaseQuantity(250, 'g', 'kg')).toBe(0.25);
      // 1500 g to kg = 1.5 kg
      expect(convertToBaseQuantity(1500, 'g', 'kg')).toBe(1.5);
    });

    it('converts kilograms to grams correctly', () => {
      // 0.5 kg to g = 500 g
      expect(convertToBaseQuantity(0.5, 'kg', 'g')).toBe(500);
    });

    it('converts milliliters to liters correctly', () => {
      // 200 ml to liter = 0.2 liter
      expect(convertToBaseQuantity(200, 'ml', 'liter')).toBe(0.2);
    });

    it('converts cups and shots to milliliters correctly', () => {
      // 1 cup = 240 ml
      expect(convertToBaseQuantity(1, 'cup', 'ml')).toBe(240);
      // 2 shots = 60 ml
      expect(convertToBaseQuantity(2, 'shot', 'ml')).toBe(60);
    });

    it('returns original amount when units match', () => {
      expect(convertToBaseQuantity(5, 'piece', 'piece')).toBe(5);
    });
  });

  describe('convertFromBaseQuantity', () => {
    it('converts from kg to g for display', () => {
      expect(convertFromBaseQuantity(0.2, 'kg', 'g')).toBe(200);
    });

    it('converts from liter to ml for display', () => {
      expect(convertFromBaseQuantity(0.25, 'liter', 'ml')).toBe(250);
    });
  });

  describe('getInitialDisplayUnitAndQty', () => {
    it('defaults fractional kg to grams for easy recipe input', () => {
      const res = getInitialDisplayUnitAndQty(0.15, 'kg');
      expect(res.displayQty).toBe(150);
      expect(res.displayUnit).toBe('g');
    });

    it('defaults fractional liter to milliliters', () => {
      const res = getInitialDisplayUnitAndQty(0.25, 'liter');
      expect(res.displayQty).toBe(250);
      expect(res.displayUnit).toBe('ml');
    });

    it('defaults zero kg to grams for quick input', () => {
      const res = getInitialDisplayUnitAndQty(0, 'kg');
      expect(res.displayQty).toBe(0);
      expect(res.displayUnit).toBe('g');
    });
  });
});
