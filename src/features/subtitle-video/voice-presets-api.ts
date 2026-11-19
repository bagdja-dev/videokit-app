// Client videokit-api /voice-presets. Tipe = cerminan DTO di API (src/modules/voice-preset/dto/voice-preset.dto.ts) — jaga sinkron.
import { apiCall } from '@/core/api/client';
import type { VoiceFx } from '@/core/render';

/** = VoiceFxDto di API (nilai slider Suara narasi). */
export type VoiceFxDto = VoiceFx;

export interface VoicePresetDto {
  id: string;
  name: string;
  fx: VoiceFxDto;
  created_at: string;
  updated_at: string;
}
export interface VoicePresetListResponseDto { items: VoicePresetDto[]; limit: number }
export interface CreateVoicePresetRequestDto { name: string; fx: VoiceFxDto }
export interface UpdateVoicePresetRequestDto { name?: string; fx?: VoiceFxDto }

export const listVoicePresets = () => apiCall<VoicePresetListResponseDto>('GET', '/voice-presets');
export const createVoicePreset = (dto: CreateVoicePresetRequestDto) => apiCall<VoicePresetDto>('POST', '/voice-presets', dto);
export const updateVoicePreset = (id: string, dto: UpdateVoicePresetRequestDto) => apiCall<VoicePresetDto>('PATCH', `/voice-presets/${id}`, dto);
export const deleteVoicePreset = (id: string) => apiCall<{ id: string; deleted: true }>('DELETE', `/voice-presets/${id}`);
