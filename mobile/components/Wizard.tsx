// mobile/components/Wizard.tsx
// Componente único para todos los formularios de carga (tarea, riego, fito, campaña).
// Lee la doctrina en docs/DESIGN_SYSTEM.md sección 8 antes de modificar.

import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius, text, tapTarget } from '../lib/theme';

export interface WizardStep<T> {
  /** Título grande arriba del paso, en formato "¿pregunta?" */
  title: string;
  /** Componente que renderiza los inputs y reporta valor */
  Component: React.ComponentType<{
    value: T;
    onChange: (next: T) => void;
  }>;
  /** Predicate: ¿con el valor actual se puede avanzar? */
  canAdvance: (value: T) => boolean;
}

interface WizardProps<T> {
  steps: WizardStep<T>[];
  initialValue: T;
  /** Texto del header del wizard ("Nueva tarea", "Nuevo riego", etc.) */
  headerTitle: string;
  /** Callback al confirmar. Si tira, el botón muestra error y deja reintentar. */
  onConfirm: (value: T) => Promise<void>;
  /** Callback al cancelar (back desde paso 1). */
  onCancel: () => void;
  /** Texto del botón en el paso final. Default: "✓ Confirmar". */
  confirmLabel?: string;
}

export function Wizard<T>({
  steps,
  initialValue,
  headerTitle,
  onConfirm,
  onCancel,
  confirmLabel = '✓ Confirmar',
}: WizardProps<T>) {
  const [stepIdx, setStepIdx] = useState(0);
  const [value, setValue] = useState<T>(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLast = stepIdx === steps.length - 1;
  const current = steps[stepIdx]!;
  const StepComponent = current.Component;
  const canAdvance = current.canAdvance(value);

  const handleBack = useCallback(() => {
    if (stepIdx === 0) onCancel();
    else setStepIdx(i => i - 1);
  }, [stepIdx, onCancel]);

  const handleNext = useCallback(async () => {
    if (!canAdvance || submitting) return;
    if (!isLast) {
      setStepIdx(i => i + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(value);
    } catch (e: any) {
      setError(e?.message ?? 'Error al guardar. Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }, [canAdvance, submitting, isLast, value, onConfirm]);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBack} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.blanco} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Stepper */}
      <View style={styles.stepper}>
        {steps.map((_, i) => (
          <React.Fragment key={i}>
            <View style={[
              styles.dot,
              i <= stepIdx && styles.dotActive,
            ]}>
              <Text style={[styles.dotText, i <= stepIdx && styles.dotTextActive]}>{i + 1}</Text>
            </View>
            {i < steps.length - 1 && (
              <View style={[styles.line, i < stepIdx && styles.lineActive]} />
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Title */}
      <View style={styles.titleBlock}>
        <Text style={styles.stepLabel}>PASO {stepIdx + 1} / {steps.length}</Text>
        <Text style={styles.stepTitle}>{current.title}</Text>
      </View>

      {/* Step content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <StepComponent value={value} onChange={setValue} />
      </ScrollView>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={colors.sangre} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Footer buttons */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.btnSecondary} onPress={handleBack} disabled={submitting}>
          <Text style={styles.btnSecondaryText}>← Atrás</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, (!canAdvance || submitting) && styles.btnDisabled]}
          onPress={handleNext}
          disabled={!canAdvance || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={colors.blanco} />
          ) : (
            <Text style={styles.btnPrimaryText}>
              {isLast ? confirmLabel : 'Siguiente →'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.blanco },
  header: {
    height: 48, backgroundColor: colors.burdeos[600],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.s4,
  },
  headerBack: { padding: space.s1 },
  headerTitle: { ...text.h3, color: colors.blanco },
  stepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: space.s4, gap: space.s2,
  },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.niebla, backgroundColor: colors.blanco,
    justifyContent: 'center', alignItems: 'center',
  },
  dotActive: { borderColor: colors.burdeos[600], backgroundColor: colors.burdeos[600] },
  dotText: { ...text.small, color: colors.niebla, fontWeight: '700' },
  dotTextActive: { color: colors.blanco },
  line: { width: 32, height: 2, backgroundColor: colors.niebla, borderRadius: 1 },
  lineActive: { backgroundColor: colors.burdeos[600] },
  titleBlock: { paddingHorizontal: space.s4, paddingBottom: space.s4 },
  stepLabel: { ...text.micro, color: colors.ink60, marginBottom: 4 },
  stepTitle: { ...text.h2, color: colors.ink },
  scroll: { flex: 1 },
  scrollContent: { padding: space.s4, paddingBottom: space.s8 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space.s2,
    backgroundColor: '#fee', paddingHorizontal: space.s4, paddingVertical: space.s3,
    borderTopWidth: 1, borderTopColor: colors.sangre,
  },
  errorText: { ...text.small, color: colors.sangre, flex: 1 },
  footer: {
    flexDirection: 'row', gap: space.s2,
    padding: space.s4, paddingBottom: space.s6,
    borderTopWidth: 1, borderTopColor: colors.hueso,
    backgroundColor: colors.blanco,
  },
  btnSecondary: {
    paddingHorizontal: space.s4, height: tapTarget.default,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.ink, borderRadius: radius.md,
    backgroundColor: colors.blanco,
  },
  btnSecondaryText: { ...text.body, fontWeight: '600', color: colors.ink },
  btnPrimary: {
    flex: 1, height: tapTarget.primary,
    backgroundColor: colors.burdeos[600], borderRadius: radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  btnPrimaryText: { ...text.body, fontWeight: '700', color: colors.blanco, fontSize: 15 },
  btnDisabled: { opacity: 0.55 },
});
