import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing } from '../../lib/theme';

export default function ResetPasswordScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const requestCode = async () => {
    if (!email.trim().includes('@')) {
      Alert.alert('Email', 'Enter the email address for your account.');
      return;
    }
    setRequesting(true);
    try {
      await appApi.forgotPassword({ email: email.trim() });
      Alert.alert('Check your email', 'If that account exists, we sent a reset code.');
    } catch (error) {
      Alert.alert('Could not send code', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setRequesting(false);
    }
  };

  const reset = async () => {
    if (!email.trim().includes('@') || !code.trim() || newPassword.length < 8) {
      Alert.alert('Reset password', 'Enter your email, the reset code, and a new password of at least 8 characters.');
      return;
    }
    setResetting(true);
    try {
      await appApi.resetPassword({
        email: email.trim(),
        code: code.trim(),
        newPassword,
      });
      Alert.alert('Password updated', 'Your password has been reset. Sign in with the new password.');
      router.replace('/(auth)/welcome');
    } catch (error) {
      Alert.alert('Could not reset password', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
            Reset your password
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
            Request a code, then enter it here with your new password.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.md }}>
            <TextInput
              {...inputProps}
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              mode="outlined"
            />
            <Button mode="outlined" textColor={colors.primary} loading={requesting} onPress={() => void requestCode()}>
              Send reset code
            </Button>
            <TextInput
              {...inputProps}
              label="Reset code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              mode="outlined"
              maxLength={6}
            />
            <TextInput
              {...inputProps}
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              mode="outlined"
              returnKeyType="go"
              onSubmitEditing={() => void reset()}
            />
            <Button mode="contained" buttonColor={colors.primary} textColor={colors.buttonText} loading={resetting} onPress={() => void reset()}>
              Reset password
            </Button>
          </Card.Content>
        </Card>

        <Button mode="text" textColor={colors.muted} onPress={() => router.back()}>
          Back
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...authCardStyle,
  },
});
